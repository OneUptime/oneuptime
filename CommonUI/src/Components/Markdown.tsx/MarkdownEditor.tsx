import React, {
    FunctionComponent,
    ReactElement,
} from 'react';
import TextArea from '../TextArea/TextArea';

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

const MarkdownEditor: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    return (
        <TextArea
            initialValue={props.initialValue || ''}
            placeholder={props.placeholder}
            onChange={props.onChange ? props.onChange : ()=> {}}
            onFocus={props.onFocus ? props.onFocus : ()=> {}}
            onBlur={props.onBlur ? props.onBlur : ()=>{}}
        />
    );
};

export default MarkdownEditor;
