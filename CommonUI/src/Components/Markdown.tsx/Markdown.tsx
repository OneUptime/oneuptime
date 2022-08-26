import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import MDEditor from '@uiw/react-md-editor';
import rehypeSanitize from "rehype-sanitize";

export interface ComponentProps {
    initialValue?: undefined | string;
    onClick?: undefined | (() => void);
    placeholder?: undefined | string;
    className?: undefined | string;
    onChange?: undefined | ((value: string) => void);
    value?: string | undefined;
    onFocus?: (() => void) | undefined;
    onBlur?: (() => void) | undefined;
}

const Markdown: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [value, setValue] = useState<string>('');

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

    return (
        <div
            className={`flex ${props.className}`}
            onClick={() => {
                props.onClick && props.onClick();
                props.onFocus && props.onFocus();
            }}
        >
            <MDEditor
                height={200}
                value={value}
                onBlur={() => {
                    if (props.onBlur) {
                        props.onBlur();
                    }
                }}
                style={{
                    width: "100%"
                }}
                visibleDragbar={false}
                previewOptions={{
                    rehypePlugins: [[rehypeSanitize]],
                }}
                preview={'edit'}
                placeholder={props.placeholder}
                onChange={(text: string | undefined) => {
                    if (text) {
                        setValue(text);
                        if (props.onChange) {
                            props.onChange(text);
                        }
                    }
                }} />
        </div>
    );
};

export default Markdown;
