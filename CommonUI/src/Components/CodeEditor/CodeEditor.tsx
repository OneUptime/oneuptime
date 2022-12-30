import Editor from 'react-simple-code-editor';
import PrismJS, { highlight, Grammar } from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/themes/prism.css';
import CodeType from 'Common/Types/Code/CodeType';

import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';

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
}

const CodeEditor: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
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
            className={`flex ${props.className}`}
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
        </div>
    );
};

export default CodeEditor;
