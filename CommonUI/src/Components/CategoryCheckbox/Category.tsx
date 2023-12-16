import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import { CategoryCheckboxOption, CheckboxCategory } from './CategoryCheckboxTypes';
import CheckboxElement from '../Checkbox/Checkbox';
import CheckBoxList from './CheckboxList';

export type CategoryCheckboxValue = string | number | boolean;

export interface CategoryProps {
    category: CheckboxCategory;
    options: Array<CategoryCheckboxOption>;
    onChange: (value: Array<CategoryCheckboxValue>) => void;
    initialValue?: undefined | Array<CategoryCheckboxValue>;
}

const LabelElement: FunctionComponent<CategoryProps> = (
    props: CategoryProps
): ReactElement => {
    const [currentValues, setCurrentValues] = React.useState<Array<CategoryCheckboxValue>>(props.initialValue || []);
    const [isCategoryChecked, setIsCategoryChecked] = React.useState<boolean>(false);

    useEffect(() => {
        // check if all of the options are checked. and if so, check the category
        const allOptionsChecked: boolean = props.options.every((option: CategoryCheckboxOption) => {
            return currentValues.includes(option.value);
        });

        if (allOptionsChecked) {
            setIsCategoryChecked(true);
        }
        else {
            setIsCategoryChecked(false);
        }

        props.onChange(currentValues); 

    }, [currentValues]);

    return (
        <div>
            <div>
                <CheckboxElement title={props.category.title} initialValue={isCategoryChecked} onChange={(isChecked) => {
                    if (isChecked) {
                        // add all of the options to the currentValues array
                        const newValues: Array<CategoryCheckboxValue> = [...currentValues];
                        props.options.forEach((option: CategoryCheckboxOption) => {
                            newValues.push(option.value);
                        });
                        setCurrentValues(newValues);
                        props.onChange(newValues);
                    }
                    else {
                        // remove all of the options from the currentValues array
                        const newValues: Array<CategoryCheckboxValue> = [...currentValues];
                        props.options.forEach((option: CategoryCheckboxOption) => {
                            const index: number = newValues.findIndex((value: CategoryCheckboxValue) => value === option.value);
                            newValues.splice(index, 1);
                        });
                        setCurrentValues(newValues);
                        props.onChange(newValues);
                    }
                }} />
            </div>
            <div className="ml-3">
                <CheckBoxList options={props.options} onChange={(newValues: Array<CategoryCheckboxValue>) => {
                    setCurrentValues(newValues);
                    props.onChange(newValues);
                }} />
            </div>
        </div>
    );
};

export default LabelElement;
