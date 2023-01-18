import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import 'react-toggle/style.css';

export interface RadioButton {
    title: string;
    description?: string | undefined;
    value: string;
    sideTitle?: string | undefined;
    sideDescription?: string | undefined;
}

export interface ComponentProps {
    onChange: (value: string) => void;
    initialValue?: string | undefined;
    options: Array<RadioButton>;
    error?: string | undefined;
}

const RadioButtons: FunctionComponent<ComponentProps> = (
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
            <fieldset>
                <div className="space-y-2 mt-2">
                    {props.options &&
                        props.options.map(
                            (radioButton: RadioButton, i: number) => {
                                let className: string =
                                    'relative block cursor-pointer rounded-lg border bg-white px-6 py-4 shadow-sm focus:outline-none sm:flex sm:justify-between';

                                if (value === radioButton.value) {
                                    className =
                                        'relative block cursor-pointer rounded-lg border bg-white px-6 py-4 shadow-sm focus:outline-none sm:flex sm:justify-between border-indigo-500 ring-2 ring-indigo-500';
                                }

                                return (
                                    <label
                                        key={i}
                                        className={className}
                                        onClick={() => {
                                            handleChange(radioButton.value);
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            className="sr-only"
                                            aria-labelledby="server-size-0-label"
                                            aria-describedby="server-size-0-description-0 server-size-0-description-1"
                                        />
                                        <span className="flex items-center">
                                            <span className="flex flex-col text-sm">
                                                <span
                                                    id="server-size-0-label"
                                                    className="font-medium text-gray-900"
                                                >
                                                    {radioButton.title}
                                                </span>
                                                <span
                                                    id="server-size-0-description-0"
                                                    className="text-gray-500"
                                                >
                                                    <span className="block sm:inline">
                                                        {' '}
                                                        {
                                                            radioButton.description
                                                        }
                                                    </span>
                                                </span>
                                            </span>
                                        </span>
                                        <span
                                            id="server-size-0-description-1"
                                            className="mt-2 flex text-sm sm:mt-0 sm:ml-4 sm:flex-col sm:text-right"
                                        >
                                            <span className="font-medium text-gray-900">
                                                {radioButton.sideTitle}
                                            </span>
                                            <span className="ml-1 text-gray-500 sm:ml-0">
                                                {radioButton.sideDescription}
                                            </span>
                                        </span>

                                        <span
                                            className="pointer-events-none absolute -inset-px rounded-lg border-2"
                                            aria-hidden="true"
                                        ></span>
                                    </label>
                                );
                            }
                        )}
                </div>
            </fieldset>
            {props.error && (
                <p className="mt-1 text-sm text-red-400">{props.error}</p>
            )}
        </div>
    );
};

export default RadioButtons;
