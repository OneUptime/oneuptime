import Editor from 'react-simple-code-editor';
import { highlight, languages } from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/themes/prism.css';
import CodeType from "Common/Types/Code/CodeType";

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
}

const CodeEditor: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [value, setValue] = useState<string>('');


    useEffect(() => {
        props.onChange && props.onChange(value);
    }, [value])

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

    return (
        <div
            className={`flex ${props.className}`}
            onClick={() => {
                props.onClick && props.onClick();
                props.onFocus && props.onFocus();
            }}
        >
            <Editor
                id={props.dataTestId}
                value={value}
                onValueChange={code => setValue(code)}
                highlight={code => highlight(code,  (props.type === CodeType.JavaScript ? (languages as any).js :
                    props.type === CodeType.CSS ? (languages as any).css : (languages as any).html) as any)}
                padding={10}
                style={{
                    fontFamily: '"Fira code", "Fira Mono", monospace',
                    fontSize: 12,
                }}
                placeholder={props.placeholder}
                onBlur={() => {
                    if (props.onBlur) {
                        props.onBlur();
                    }
                }}
                disabled={props.readOnly}
            />
        </div>
    );
};

export default CodeEditor;
