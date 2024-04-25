import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import {
    CategoryCheckboxOption,
    CheckboxCategory,
} from './CategoryCheckboxTypes';
import CheckboxElement from '../Checkbox/Checkbox';
import CheckBoxList from './CheckboxList';

export type CategoryCheckboxValue = string | number | boolean;

export interface CategoryProps {
    category?: CheckboxCategory | undefined;
    options: Array<CategoryCheckboxOption>;
    onChange: (value: Array<CategoryCheckboxValue>) => void;
    initialValue?: undefined | Array<CategoryCheckboxValue>;
    isLastCategory: boolean;
    dataTestId?: string | undefined;    
}

enum CategoryCheckboxValueState {
    Checked,
    Unchecked,
    Indeterminate,
}

const Category: FunctionComponent<CategoryProps> = (
    props: CategoryProps
): ReactElement => {
    const [currentValues, setCurrentValues] = React.useState<
        Array<CategoryCheckboxValue>
    >(props.initialValue || []);

    const [categoryCheckboxState, setCategoryCheckboxState] =
        React.useState<CategoryCheckboxValueState>(
            CategoryCheckboxValueState.Unchecked
        );

    useEffect(() => {
        // check if all of the options are checked. and if so, check the category

        const noOptionsChecked: boolean = currentValues.length === 0;

        if (noOptionsChecked) {
            setCategoryCheckboxState(CategoryCheckboxValueState.Unchecked);
            return;
        }

        const allOptionsChecked: boolean = props.options.every(
            (option: CategoryCheckboxOption) => {
                return currentValues.includes(option.value);
            }
        );

        if (allOptionsChecked) {
            setCategoryCheckboxState(CategoryCheckboxValueState.Checked);
        } else {
            setCategoryCheckboxState(CategoryCheckboxValueState.Indeterminate);
        }
    }, [currentValues]);

    useEffect(() => {
        setCurrentValues(props.initialValue || []);
    }, [props.initialValue]);

    return (
        <div>
            {props.category && (
                <div>
                    <CheckboxElement
                        title={props.category.title}
                        dataTestId={props.dataTestId}
                        value={
                            categoryCheckboxState ===
                            CategoryCheckboxValueState.Checked
                        }
                        isIndeterminate={
                            categoryCheckboxState ===
                            CategoryCheckboxValueState.Indeterminate
                        }
                        onChange={(
                            isChecked: boolean,
                            isIndeterminate?: boolean | undefined
                        ) => {
                            if (isIndeterminate && !isChecked) {
                                return;
                            }

                            if (isChecked) {
                                // add all of the options to the currentValues array
                                const newValues: Array<CategoryCheckboxValue> =
                                    [...currentValues];
                                props.options.forEach(
                                    (option: CategoryCheckboxOption) => {
                                        // please make sure that the option.value is not already in the array

                                        if (newValues.includes(option.value)) {
                                            return;
                                        }

                                        newValues.push(option.value);
                                    }
                                );
                                setCurrentValues(newValues);
                                props.onChange(newValues);
                            } else {
                                // remove all of the options from the currentValues array
                                const newValues: Array<CategoryCheckboxValue> =
                                    [...currentValues];
                                props.options.forEach(
                                    (option: CategoryCheckboxOption) => {
                                        while (
                                            newValues.includes(option.value)
                                        ) {
                                            const index: number =
                                                newValues.findIndex(
                                                    (
                                                        value: CategoryCheckboxValue
                                                    ) => {
                                                        return (
                                                            value ===
                                                            option.value
                                                        );
                                                    }
                                                );
                                            newValues.splice(index, 1);
                                        }
                                    }
                                );
                                setCurrentValues(newValues);
                                props.onChange(newValues);
                            }
                        }}
                    />
                </div>
            )}
            <div className={`${props.category ? 'ml-7' : ''}`}>
                <CheckBoxList
                    options={props.options}
                    initialValue={currentValues}
                    onChange={(newValues: Array<CategoryCheckboxValue>) => {
                        setCurrentValues(newValues);
                        props.onChange(newValues);
                    }}
                />
            </div>

            {!props.isLastCategory ? <div className="mt-3 mb-3"></div> : <></>}
        </div>
    );
};

export default Category;
