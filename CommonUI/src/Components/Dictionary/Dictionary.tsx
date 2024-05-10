import Dictionary from 'Common/Types/Dictionary';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import Button, { ButtonSize, ButtonStyleType } from '../Button/Button';
import Input, { InputType } from '../Input/Input';
import IconProp from 'Common/Types/Icon/IconProp';
import Dropdown, { DropdownOption, DropdownValue } from '../Dropdown/Dropdown';

export enum ValueType {
    Text = 'Text',
    Number = 'Number',
    Boolean = 'Boolean',
}

export interface ComponentProps {
    onChange?:
        | undefined
        | ((value: Dictionary<string | boolean | number>) => void);
    initialValue?: Dictionary<string>;
    keyPlaceholder?: string;
    valuePlaceholder?: string;
    addButtonSuffix?: string;
    valueTypes?: Array<ValueType>; // by default it'll be Text
}

interface Item {
    key: string;
    value: string | number | boolean;
    type: ValueType;
}

const DictionaryForm: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const valueTypes: Array<ValueType> =
        props.valueTypes && props.valueTypes.length > 0
            ? props.valueTypes
            : [ValueType.Text];
    const dropdownOptionsForValueTypes: Array<DropdownOption> = valueTypes.map(
        (valueType: ValueType) => {
            return {
                label: valueType,
                value: valueType,
            };
        }
    );

    const [data, setData] = useState<Array<Item>>(
        Object.keys(
            props.initialValue || {
                '': '',
            }
        ).map((key: string) => {
            return {
                key: key!,
                value: props.initialValue![key] || '',
                type: valueTypes[0] as ValueType,
            };
        }) || [
            {
                key: '',
                value: '',
                type: valueTypes[0] as ValueType,
            },
        ]
    );

    useEffect(() => {
        const result: Dictionary<string | number | boolean> = {};
        data.forEach((item: Item) => {
            result[item.key] = item.value;
        });
        if (props.onChange) {
            props.onChange(result);
        }
    }, [data]);

    const trueDropdwonOption = {
        label: 'True',
        value: 'True',
    };

    const falseDropdwonOption = {
        label: 'False',
        value: 'False',
    };

    return (
        <div>
            <div>
                {data.map((item: Item, index: number) => {
                    return (
                        <div key={index} className="flex">
                            <div className="mr-1">
                                <Input
                                    value={item.key}
                                    placeholder={props.keyPlaceholder}
                                    onChange={(value: string) => {
                                        const newData: Array<Item> = [...data];
                                        newData[index]!.key = value;
                                        setData(newData);
                                    }}
                                />
                            </div>
                            {valueTypes.length > 1 && (
                                <div className="ml-1">
                                    <Dropdown
                                        value={dropdownOptionsForValueTypes.find(
                                            (dropdownOption) => {
                                                return (
                                                    dropdownOption.value ===
                                                    item.type
                                                );
                                            }
                                        )}
                                        options={dropdownOptionsForValueTypes}
                                        isMultiSelect={false}
                                        onChange={(
                                            selectedOption:
                                                | DropdownValue
                                                | Array<DropdownValue>
                                                | null
                                        ) => {
                                            const newData: Array<Item> = [
                                                ...data,
                                            ];
                                            newData[index]!.type =
                                                (selectedOption as ValueType) ||
                                                valueTypes[0];
                                            setData(newData);
                                        }}
                                    />
                                </div>
                            )}
                            <div className="ml-1">
                                {item.type === ValueType.Text && (
                                    <Input
                                        value={item.value.toString()}
                                        placeholder={props.valuePlaceholder}
                                        onChange={(value: string) => {
                                            const newData: Array<Item> = [
                                                ...data,
                                            ];
                                            newData[index]!.value = value;
                                            setData(newData);
                                        }}
                                    />
                                )}

                                {item.type === ValueType.Number && (
                                    <Input
                                        value={item.value.toString()}
                                        placeholder={props.valuePlaceholder}
                                        onChange={(value: string) => {
                                            const newData: Array<Item> = [
                                                ...data,
                                            ];

                                            if (
                                                typeof value === 'string' &&
                                                value.length > 0
                                            ) {
                                                newData[index]!.value =
                                                    parseInt(value);
                                            } else {
                                                delete newData[index];
                                            }

                                            setData(newData);
                                        }}
                                        type={InputType.NUMBER}
                                    />
                                )}

                                {item.type === ValueType.Boolean && (
                                    <Dropdown
                                        value={
                                            item.value === true
                                                ? trueDropdwonOption
                                                : falseDropdwonOption
                                        }
                                        options={[
                                            trueDropdwonOption,
                                            falseDropdwonOption,
                                        ]}
                                        isMultiSelect={false}
                                        onChange={(
                                            selectedOption:
                                                | DropdownValue
                                                | Array<DropdownValue>
                                                | null
                                        ) => {
                                            const newData: Array<Item> = [
                                                ...data,
                                            ];
                                            if (selectedOption === 'True') {
                                                newData[index]!.value = true;
                                            }

                                            if (selectedOption === 'False') {
                                                newData[index]!.value = false;
                                            }

                                            setData(newData);
                                        }}
                                    />
                                )}
                            </div>
                            <div className="ml-1 mt-1">
                                <Button
                                    dataTestId={`delete-${item.key}`}
                                    title="Delete"
                                    buttonStyle={ButtonStyleType.ICON}
                                    icon={IconProp.Trash}
                                    onClick={() => {
                                        const newData: Array<Item> = [...data];
                                        newData.splice(index, 1);
                                        setData(newData);
                                    }}
                                />
                            </div>
                        </div>
                    );
                })}
                <div className="-ml-3 mt-4">
                    <Button
                        title={`Add ${props.addButtonSuffix || 'Item'}`}
                        icon={IconProp.Add}
                        buttonSize={ButtonSize.Small}
                        onClick={() => {
                            setData([
                                ...data,
                                {
                                    key: '',
                                    value: '',
                                    type: valueTypes[0] as ValueType,
                                },
                            ]);
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

export default DictionaryForm;
