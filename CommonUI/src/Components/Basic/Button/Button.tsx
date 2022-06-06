import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import { MouseOnClick, KeyboardEventProp } from '../../../Types/HtmlEvents';
import ShortcutKey from '../ShortcutKey/ShortcutKey';
import ButtonType from './ButtonTypes';

export interface ComponentProps {
    title: string;
    onClick?: MouseOnClick;
    disabled?: boolean;
    id: string;
    shortcutKey?: ShortcutKey;
    type?: ButtonType;
    isLoading?: boolean;
}

const Button: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    // props validation
    if (!props.type) {
        props.type = ButtonType.Button;
    }

    useEffect(() => {
        // componentDidMount
        if (props.shortcutKey) {
            window.addEventListener('keydown', (e) => {
                return handleKeyboard(e as KeyboardEventProp);
            });
        }

        // componentDidUnmount
        return () => {
            if (props.shortcutKey) {
                window.removeEventListener('keydown', (e) => {
                    return handleKeyboard(e as KeyboardEventProp);
                });
            }
        };
    });

    const handleKeyboard = (event: KeyboardEventProp) => {
        if (
            event.target instanceof HTMLBodyElement &&
            event.key &&
            props.shortcutKey
        ) {
            switch (event.key) {
                case props.shortcutKey.toUpperCase():
                case props.shortcutKey.toLowerCase():
                    props.onClick && props.onClick();
                    return;
                default:
                    return;
            }
        }
    };

    return (
        <button
            id={props.id}
            onClick={props.onClick}
            className={`${'Button bs-ButtonLegacy ActionIconParent'} ${
                props.disabled ? 'Is--disabled' : ''
            }`}
            type={props.type}
            disabled={props.disabled}
        >
            <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                <div className="Box-root Margin-right--8">
                    <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                </div>
                <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                    <span>{props.title}</span>
                    {props.shortcutKey && (
                        <span className="new-btn__keycode">
                            {props.shortcutKey}
                        </span>
                    )}
                </span>
            </div>
        </button>
    );
};

export default Button;
