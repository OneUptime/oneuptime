import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import { CategoryCheckboxOption } from './CategoryCheckboxTypes';
import CheckboxElement from '../Checkbox/Checkbox';
import GenericObject from 'Common/Types/GenericObject';
import { JSONObject } from 'Common/Types/JSON';

export type CategoryCheckboxValue = string | number | boolean;

type EnumToCategoryCheckboxOptionFunction = (
    obj: GenericObject
) => Array<CategoryCheckboxOption>;

export const enumToCategoryCheckboxOption: EnumToCategoryCheckboxOptionFunction =
    (obj: GenericObject): Array<CategoryCheckboxOption> => {
        const options: Array<CategoryCheckboxOption> = [];

        for (const key in obj) {
            options.push({
                label: ((obj as JSONObject)[key] as string).toString(),
                value: ((obj as JSONObject)[key] as string).toString(),
            });
        }

        return options;
    };

export interface CategoryProps {
    options: Array<CategoryCheckboxOption>;
    onChecked?: (value: CategoryCheckboxValue) => void;
    onUnchecked?: (value: CategoryCheckboxValue) => void;
    onChange: (checked: Array<CategoryCheckboxValue>) => void;
    initialValue?: undefined | Array<CategoryCheckboxValue>;
}

const CheckBoxList: FunctionComponent<CategoryProps> = (
    props: CategoryProps
): ReactElement => {
    const [currentValues, setCurrentValues] = React.useState<
        Array<CategoryCheckboxValue>
    >(props.initialValue || []);

    useEffect(() => {
        setCurrentValues(props.initialValue || []);
    }, [props.initialValue]);

    return (
        <div>
            {props.options.map((option: CategoryCheckboxOption, i: number) => {
                return (
                    <CheckboxElement
                        key={i}
                        title={option.label}
                        value={Boolean(
                            currentValues?.find(
                                (value: CategoryCheckboxValue) => {
                                    return value === option.value;
                                }
                            ) || false
                        )}
                        onChange={(changedValue: boolean) => {
                            if (changedValue) {
                                props.onChecked &&
                                    props.onChecked(option.value);

                                // add the option.value to the currentValues array
                                const newValues: Array<CategoryCheckboxValue> =
                                    [...currentValues];

                                if (newValues.includes(option.value)) {
                                    return;
                                }

                                newValues.push(option.value);
                                setCurrentValues(newValues);
                                props.onChange(newValues);
                            } else {
                                props.onUnchecked &&
                                    props.onUnchecked(option.value);

                                // remove the option.value from the currentValues array

                                const newValues: Array<CategoryCheckboxValue> =
                                    [...currentValues];

                                while (newValues.includes(option.value)) {
                                    const index: number = newValues.findIndex(
                                        (value: CategoryCheckboxValue) => {
                                            return value === option.value;
                                        }
                                    );
                                    newValues.splice(index, 1);
                                }

                                setCurrentValues(newValues);
                                props.onChange(newValues);
                            }
                        }}
                    />
                );
            })}
        </div>
    );
};

export default CheckBoxList;
