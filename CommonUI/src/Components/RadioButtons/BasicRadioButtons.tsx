import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';

export interface BasicRadioButton {
    title: string;
    description?: string | undefined;
    value: string;
    children?: ReactElement | undefined;
}

export interface ComponentProps {
    onChange: (value: string) => void;
    initialValue?: string | undefined;
    options: Array<BasicRadioButton>;
    error?: string | undefined;
}

const BasicRadioButton: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [value, setValue] = useState<string>('');

    useEffect(() => {
        if (props.initialValue) {
            setValue(props.initialValue);
            props.onChange(props.initialValue);
        } else {
            setValue('');
            props.onChange('');
        }
    }, [props.initialValue]);

    const handleChange: Function = (content: string): void => {
        setValue(content);
        props.onChange(content);
    };


    return (
        <div>
            <label className="text-base font-semibold text-gray-900">Notifications</label>
            <p className="text-sm text-gray-500">How do you prefer to receive notifications?</p>
            <fieldset className="mt-4">
                <legend className="sr-only">Notification method</legend>
                <div className="space-y-4">
                    {props.options.map((radioButton: BasicRadioButton, i: number) => (
                        <div key={i} >
                            <div className="flex items-center">
                                <input
                                    type="radio"
                                    defaultChecked={
                                        value ===
                                        radioButton.value
                                    }
                                    onClick={() => {
                                        handleChange(radioButton.value);
                                    }}
                                    className="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-600"
                                />
                                <label className="ml-3 block text-sm font-medium leading-6 text-gray-900">
                                    <span className="font-medium text-gray-900">
                                        {radioButton.title}
                                    </span>
                                    <span className="ml-1 text-gray-500 sm:ml-0">
                                        {radioButton.description}
                                    </span>
                                </label>
                            </div>
                            {radioButton.children}
                        </div>
                    ))}
                </div>
            </fieldset>
        </div>
    )
};

export default RadioButtons;
