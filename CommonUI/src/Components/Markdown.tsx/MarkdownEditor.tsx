import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import TextArea from '../TextArea/TextArea';

export interface ComponentProps {
    initialValue?: undefined | string;
    placeholder?: undefined | string;
    className?: undefined | string;
    onChange?: undefined | ((value: string) => void);
    onFocus?: (() => void) | undefined;
    onBlur?: (() => void) | undefined;
    tabIndex?: number | undefined;
    error?: string | undefined;
}

const MarkdownEditor: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <TextArea
            tabIndex={props.tabIndex}
            className={props.className}
            initialValue={props.initialValue || ''}
            placeholder={props.placeholder}
            onChange={props.onChange ? props.onChange : () => {}}
            onFocus={props.onFocus ? props.onFocus : () => {}}
            onBlur={props.onBlur ? props.onBlur : () => {}}
            error={props.error}
        />
    );
};

export default MarkdownEditor;
