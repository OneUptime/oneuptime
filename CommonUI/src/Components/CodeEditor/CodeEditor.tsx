import Editor from 'react-simple-code-editor';
import type { Grammar } from 'prismjs';
import PrismJS, { highlight } from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/themes/prism.css';
import CodeType from 'Common/Types/Code/CodeType';

import type { FunctionComponent, ReactElement } from 'react';
import React, { useEffect, useState } from 'react';

export interface ComponentProps {
    initialValue?: undefined | string;
    onClick?: undefined | (() => void);
    placeholder?: undefined | string;
    className?: undefined | string;
    onChange?: undefined | ((value: string) => void);
    value?: string | undefined;
    readOnly?: boolean | undefined;
    type: CodeType;
    onFocus?: (() => void) | undefined;
    onBlur?: (() => void) | undefined;
    dataTestId?: string;
    tabIndex?: number | undefined;
    error?: string | undefined;
}

const CodeEditor: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let className: string = '';

    if (!props.className) {
        className =
            'block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:text-sm';
    } else {
        className = props.className;
    }

    if (props.error) {
        className =
            'block w-full rounded-md border bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-red-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 sm:text-sm border-red-300 pr-10 text-red-900 placeholder-red-300 focus:border-red-500 focus:outline-none focus:ring-red-500';
    }

    const [value, setValue] = useState<string>('');

    useEffect(() => {
        props.onChange && props.onChange(value);
    }, [value]);

    useEffect(() => {
        if (props.initialValue) {
            setValue(props.initialValue);
        }

        if (props.value) {
            setValue(props.value);
        }
    }, []);

    useEffect(() => {
        setValue(props.value ? props.value : '');
    }, [props.value]);

    useEffect(() => {
        if (props.initialValue) {
            setValue(props.initialValue);
        }
    }, [props.initialValue]);

    let grammar: Grammar = (PrismJS.languages as any).markup as any;
    let language: string = 'markup';

    if (props.type === CodeType.JavaScript) {
        grammar = (PrismJS.languages as any).javascript as any;
        language = 'javascript';
    }

    if (props.type === CodeType.HTML) {
        grammar = (PrismJS.languages as any).html as any;
        language = 'html';
    }

    if (props.type === CodeType.CSS) {
        grammar = (PrismJS.languages as any).css as any;
        language = 'css';
    }

    return (
        <div
            id="code-editor"
            onClick={() => {
                props.onClick && props.onClick();
                props.onFocus && props.onFocus();
            }}
        >
            <Editor
                tabIndex={props.tabIndex}
                id={props.dataTestId}
                value={value}
                onValueChange={(code: string) => {
                    return setValue(code);
                }}
                className={className}
                highlight={(code: string) => {
                    return highlight(code, grammar, language);
                }}
                padding={10}
                style={{
                    fontFamily: '"Fira code", "Fira Mono", monospace',
                    fontSize: 12,
                    maxHeight: '100px',
                    overflowX: 'hidden',
                    overflowY: 'scroll',
                    width: '100%',
                    minHeight: '200px',
                }}
                placeholder={props.placeholder || ''}
                onBlur={() => {
                    if (props.onBlur) {
                        props.onBlur();
                    }
                }}
                disabled={props.readOnly || false}
            />
            {props.error && (
                <p className="mt-1 text-sm text-red-400">{props.error}</p>
            )}
        </div>
    );
};

export default CodeEditor;
