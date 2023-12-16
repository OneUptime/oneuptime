import React, { FunctionComponent, ReactElement } from 'react';
import { CategoryCheckboxOption } from './CategoryCheckboxTypes';
import CheckboxElement from '../Checkbox/Checkbox';



export type CategoryCheckboxValue = string | number | boolean;

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

    const [currentValues, setCurrentValues] = React.useState<Array<CategoryCheckboxValue>>(props.initialValue || []);

    return (
        <div>
            {props.options.map((option: CategoryCheckboxOption, i: number) => {    
                return (
                    <CheckboxElement
                        key={i}
                        title={option.label}
                        initialValue={Boolean(props.initialValue?.find((value: CategoryCheckboxValue) => value === option.value) || false)}
                        onChange={(changedValue: boolean)=>{
                            if(changedValue){
                                props.onChecked && props.onChecked(option.value);

                                // add the option.value to the currentValues array
                                const newValues: Array<CategoryCheckboxValue> = [...currentValues];
                                newValues.push(option.value);
                                setCurrentValues(newValues);
                                props.onChange(newValues);
                            }
                            else{
                                props.onUnchecked && props.onUnchecked(option.value);

                                // remove the option.value from the currentValues array
                                const newValues: Array<CategoryCheckboxValue> = [...currentValues];
                                const index: number = newValues.findIndex((value: CategoryCheckboxValue) => value === option.value);
                                newValues.splice(index, 1);
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
