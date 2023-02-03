import type { FunctionComponent, ReactElement } from 'react';
import React, { useEffect, useState } from 'react';
import Icon, { IconProp } from '../Icon/Icon';

export interface ComponentProps {
    onChange?: undefined | ((value: string) => void);
    initialValue: string;
    placeholder?: undefined | string;
    onFocus?: () => void;
    onBlur?: () => void;
    className?: undefined | string;
    tabIndex?: number | undefined;
    error?: string | undefined;
}

const TextArea: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [text, setText] = useState<string>('');

    let className: string = '';

    if (!props.className) {
        className =
            'block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm';
    } else {
        className = props.className;
    }

    if (props.error) {
        className +=
            ' border-red-300 pr-10 text-red-900 placeholder-red-300 focus:border-red-500 focus:outline-none focus:ring-red-500';
    }

    useEffect(() => {
        if (props.initialValue) {
            setText(props.initialValue.toString());
        }
    }, [props.initialValue]);

    const handleChange: Function = (content: string): void => {
        setText(content);
        props.onChange && props.onChange(content);
    };

    return (
        <>
            <div className="relative mt-2 mb-1 rounded-md shadow-sm">
                <textarea
                    placeholder={props.placeholder}
                    className={`${className || ''}`}
                    value={text}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                        const value: string = e.target.value;

                        if (value === '\n') {
                            handleChange('');
                        }

                        handleChange(e.target.value);
                    }}
                    onFocus={() => {
                        if (props.onFocus) {
                            props.onFocus();
                        }
                    }}
                    onBlur={() => {
                        if (props.onBlur) {
                            props.onBlur();
                        }
                    }}
                    tabIndex={props.tabIndex}
                />
                {props.error && (
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                        <Icon
                            icon={IconProp.ErrorSolid}
                            className="h-5 w-5 text-red-500"
                        />
                    </div>
                )}
            </div>
            {props.error && (
                <p
                    data-testid="error-message"
                    className="mt-1 text-sm text-red-400"
                >
                    {props.error}
                </p>
            )}
        </>
    );
};

export default TextArea;
