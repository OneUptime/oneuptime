import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import {
    CategoryCheckboxOption,
    CheckboxCategory,
    CategoryCheckboxValue,
} from './CategoryCheckboxTypes';
import Category from './Category';
import ErrorMessage from '../ErrorMessage/ErrorMessage';

export interface CategoryCheckboxOptionsAndCategories {
    categories: Array<CheckboxCategory>;
    options: Array<CategoryCheckboxOption>;
}

export interface CategoryCheckboxProps
    extends CategoryCheckboxOptionsAndCategories {
    onChange: (value: Array<CategoryCheckboxValue>) => void;
    initialValue?: undefined | Array<CategoryCheckboxValue>;
    error?: string | undefined;
}

const CategoryCheckbox: FunctionComponent<CategoryCheckboxProps> = (
    props: CategoryCheckboxProps
): ReactElement => {
    const [currentValues, setCurrentValues] = React.useState<
        Array<CategoryCheckboxValue>
    >(props.initialValue || []);

    useEffect(() => {
        // whenevent currentValue changes, make sure all the values are unique. 

        const doesHaveDuplicates: boolean = currentValues.some(
            (value: CategoryCheckboxValue, index: number) => {
                return currentValues.indexOf(value) !== index;
            }
        );

        if(!doesHaveDuplicates) {
            return;
        }


        const tempCurrentValues: Array<CategoryCheckboxValue> = [];

        currentValues.forEach((value: CategoryCheckboxValue) => {
            if (!tempCurrentValues.includes(value)) {
                tempCurrentValues.push(value);
            }
        });

        setCurrentValues(tempCurrentValues);

    }, [currentValues]  );

    if (props.options.length === 0) {
        return (
            <div>
                <ErrorMessage error="No options found." />
            </div>
        );
    }

    const getCategory: Function = (
        category?: CheckboxCategory,
        isLastCategory: boolean = false
    ): ReactElement => {
        return (
            <Category
                initialValue={currentValues.filter((value: CategoryCheckboxValue) => {
                    // only return this option if it belongs to this category

                    const option: CategoryCheckboxOption | undefined =
                        props.options.find((option: CategoryCheckboxOption) => {
                            return (
                                option.value === value &&
                                (option.categoryId || '') === (category?.id || '')
                            );
                        });

                    return Boolean(option);
                })}
                category={category}
                options={props.options.filter(
                    (option: CategoryCheckboxOption) => {
                        return (option.categoryId || '') === (category?.id || '');
                    }
                )}
                isLastCategory={isLastCategory}
                onChange={(value: Array<CategoryCheckboxValue>) => {
                    // remove any value from currentValue that belongs to this category.

                    const tempCurrentValues: Array<CategoryCheckboxValue> = [
                        ...currentValues,
                    ];

                    props.options.forEach((option: CategoryCheckboxOption) => {
                        const index: number = tempCurrentValues.findIndex(
                            (value: CategoryCheckboxValue) => {
                                return (
                                    value === option.value &&
                                    (option.categoryId || '') === (category?.id || '')
                                );
                            }
                        );
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
                }}
            />
        );
    };

    return (
        <div>
            {getCategory(undefined, props.categories.length === 0)}
            {props.categories.map((category: CheckboxCategory, i: number) => {
                return <div key={i}>{getCategory(category, i === props.categories.length - 1)}</div>;
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
