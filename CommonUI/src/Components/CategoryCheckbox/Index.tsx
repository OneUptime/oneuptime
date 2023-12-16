import React, { FunctionComponent, ReactElement } from 'react';
import { CategoryCheckboxOption, CheckboxCategory, CategoryCheckboxValue } from './CategoryCheckboxTypes';
import Category from './Category';
import ErrorMessage from '../ErrorMessage/ErrorMessage';

export interface CategoryCheckboxOptionsAndCategories {
    categories: Array<CheckboxCategory>;
    options: Array<CategoryCheckboxOption>;
}

export interface CategoryCheckboxProps extends CategoryCheckboxOptionsAndCategories {
    onChange: (value: Array<CategoryCheckboxValue>) => void;
    initialValue?: undefined | Array<CategoryCheckboxValue>;
    error?: string | undefined;
}

const CategoryCheckbox: FunctionComponent<CategoryCheckboxProps> = (
    props: CategoryCheckboxProps
): ReactElement => {

    const [currentValues, setCurrentValues] = React.useState<Array<CategoryCheckboxValue>>(props.initialValue || []);

    if (props.options.length === 0) {
        return <div>
            <ErrorMessage error="No options found." />
        </div>;
    }

    const getCategory = (category?: CheckboxCategory): ReactElement => {


            return (<Category initialValue={props.initialValue} category={category} options={props.options.filter((option: CategoryCheckboxOption) => {
                return option.categoryId === category?.id;
            })} onChange={(value: Array<CategoryCheckboxValue>) => {
                // remove any value from currentValue that belongs to this category. 

                const tempCurrentValues: Array<CategoryCheckboxValue> = [...currentValues];

                props.options.forEach((option: CategoryCheckboxOption) => {
                    const index: number = tempCurrentValues.findIndex((value: CategoryCheckboxValue) => value === option.value && option.categoryId === category?.id);
                    if (index > -1) {
                        tempCurrentValues.splice(index, 1);
                    }
                });

                // add the new values to currentValue
                value.forEach((value: CategoryCheckboxValue) => {
                    tempCurrentValues.push(value);
                });

                setCurrentValues(tempCurrentValues);

                props.onChange(tempCurrentValues);

            }} />);
       
    }

    return (
        <div>
            {getCategory(undefined)}
            {props.categories.map((category: CheckboxCategory, i: number) => {
                return (<div key={i}>
                    {getCategory(category)}
                </div>)
            })}
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

export default CategoryCheckbox;
