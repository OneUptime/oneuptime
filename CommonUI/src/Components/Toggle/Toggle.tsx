import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';

export interface ComponentProps {
    onChange: (value: boolean) => void;
    initialValue: boolean;
    onFocus?: () => void;
    onBlur?: () => void;
    tabIndex?: number | undefined;
    title?: string | undefined;
    description?: string | undefined;
}

const Toggle: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isChecked, setIsChecked] = useState<boolean>(false);

    useEffect(() => {
        if (props.initialValue) {
            setIsChecked(props.initialValue);
            props.onChange(true);
        } else {
            setIsChecked(false);
            props.onChange(false);
        }
    }, [props.initialValue]);

    const handleChange: Function = (content: boolean): void => {
        setIsChecked(content);
        props.onChange(content);
    };

    let buttonClassName: string =
        'bg-gray-200 relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2';

    if (isChecked) {
        buttonClassName =
            'bg-indigo-600 relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2';
    }

    let toggleClassName: string =
        'translate-x-0 pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out';

    if (isChecked) {
        toggleClassName =
            'translate-x-5 pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out';
    }

    return (
        <div className="flex items-center">
            <button
                onClick={() => {
                    if (props.onFocus) {
                        props.onFocus();
                    }
                    if (props.onBlur) {
                        props.onBlur();
                    }
                    handleChange(!isChecked);
                }}
                tabIndex={props.tabIndex}
                type="button"
                className={buttonClassName}
                role="switch"
                aria-checked="false"
                aria-labelledby="annual-billing-label"
            >
                <span aria-hidden="true" className={toggleClassName}></span>
            </button>
            <span className="ml-3" id="annual-billing-label">
                <span className="text-sm font-medium text-gray-900">
                    {props.title}
                </span>
                <span className="text-sm text-gray-500 ml-1">
                    {props.description}
                </span>
            </span>
        </div>
    );
};

export default Toggle;
