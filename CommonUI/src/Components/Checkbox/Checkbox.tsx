import React, { FunctionComponent, ReactElement } from 'react';
export type CategoryCheckboxValue = string | number | boolean;

export interface CategoryProps {
    title: string;
    description?: string | undefined;
    initialValue?: undefined | boolean;
    onClick?: undefined | (() => void);
    onChange?: undefined | ((value: boolean) => void);
    value?: boolean | undefined;
    readOnly?: boolean | undefined;
    disabled?: boolean | undefined;
    onFocus?: (() => void) | undefined;
    onBlur?: (() => void) | undefined;
    dataTestId?: string | undefined;
    tabIndex?: number | undefined;
    error?: string | undefined;
    outerDivClassName?: string | undefined;
    autoFocus?: boolean | undefined;
    className?: string | undefined;
}

const CheckboxElement: FunctionComponent<CategoryProps> = (
    props: CategoryProps
): ReactElement => {

    const [value, setValue] = React.useState<boolean>(props.initialValue || false);

    React.useEffect(() => {
        setValue(props.value || false);
    }, [props.value]);

    React.useEffect(() => {
        if (props.onChange) {
            props.onChange(value);
        }
    }, [value]);

    return (
        <div>
            <div className={`relative flex items-start ${props.outerDivClassName || ''}`}>
                <div className="flex h-6 items-center">
                    <input checked={value} onChange={(event) => {
                        setValue(event.target.checked);
                    }} autoFocus={props.autoFocus} tabIndex={props.tabIndex} readOnly={props.readOnly} disabled={props.disabled} onFocus={props.onFocus} onBlur={props.onBlur} data-testid={props.dataTestId} aria-describedby="comments-description" name="comments" type="checkbox" className={`h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 ${props.className || ''}`} />
                </div>
                <div className="ml-3 text-sm leading-6">
                    <label className="font-medium text-gray-900">{props.title}</label>
                    {props.description && <span className="text-gray-500">{props.description}</span>}
                </div>
            </div>
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

export default CheckboxElement;
