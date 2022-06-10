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
            window.addEventListener('keydown', e =>
                handleKeyboard(e as KeyboardEventProp)
            );
        }

        // componentDidUnmount
        return () => {
            if (props.shortcutKey) {
                window.removeEventListener('keydown', e =>
                    handleKeyboard(e as KeyboardEventProp)
                );
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
            type={props.type}
            disabled={props.disabled}
        >
            <div>
                <div>
                    <div></div>
                </div>
                <span>
                    <span>{props.title}</span>
                    {props.shortcutKey && (
                        <span className="newButtonKeycode">
                            {props.shortcutKey}
                        </span>
                    )}
                </span>
            </div>
        </button>
    );
};

export default Button;
