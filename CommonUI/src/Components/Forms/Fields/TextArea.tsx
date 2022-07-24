import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';

export interface ComponentProps {
    onChange: (value: string) => void;
    initialValue: string;
    placeholder?: undefined | string;
}

const TextArea: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [text, setText] = useState<string>('');

    useEffect(() => {
        if (props.initialValue) {
            setText(props.initialValue.toString());
        }
    }, []);

    const handleChange: Function = (content: string): void => {
        setText(content);
        props.onChange(content);
    };

    return (
        <div>
            <textarea
                placeholder={props.placeholder}
                className="form-control"
                value={text}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                    handleChange(e.target.value);
                }}
            />
        </div>
    );
};

export default TextArea;
