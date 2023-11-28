import ObjectID from 'Common/Types/ObjectID';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';

export interface BasicRadioButtonOption {
    title: string;
    description?: string | undefined;
    value: string;
    children?: ReactElement | undefined;
}

export interface ComponentProps {
    onChange: (value: string) => void;
    initialValue?: string | undefined;
    options: Array<BasicRadioButtonOption>;
    error?: string | undefined;
    id?: string | undefined;
}

const BasicRadioButton: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [id] = useState<string>(props.id || ObjectID.generate().toString());

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
            <fieldset id={id} className="mt-4">
                <div className="space-y-4">
                    {props.options.map(
                        (radioButton: BasicRadioButtonOption, i: number) => {
                            const checked: boolean =
                                value === radioButton.value;

                            return (
                                <div key={i}>
                                    <div className="flex items-center">
                                        <input
                                            type="radio"
                                            name={id}
                                            defaultChecked={checked}
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
                                    {checked && radioButton.children}
                                </div>
                            );
                        }
                    )}
                </div>
            </fieldset>
            {props.error && (
                <p
                    data-testid="error-message"
                    className="mt-1 text-sm text-red-400"
                >
                    {props.error}
                </p>
            )}
        </div>
    );
};

export default BasicRadioButton;
