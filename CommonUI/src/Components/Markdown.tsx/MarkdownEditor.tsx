import React, { FunctionComponent, ReactElement } from 'react';
import TextArea from '../TextArea/TextArea';

export interface ComponentProps {
    initialValue?: undefined | string;
    placeholder?: undefined | string;
    className?: undefined | string;
    onChange?: undefined | ((value: string) => void);
    onFocus?: (() => void) | undefined;
    onBlur?: (() => void) | undefined;
}

const MarkdownEditor: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <TextArea
            className={props.className}
            initialValue={props.initialValue || ''}
            placeholder={props.placeholder}
            onChange={props.onChange ? props.onChange : () => {}}
            onFocus={props.onFocus ? props.onFocus : () => {}}
            onBlur={props.onBlur ? props.onBlur : () => { }}
        />
    );
};

export default MarkdownEditor;
