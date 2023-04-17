import { Dictionary } from 'lodash';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import Button, { ButtonSize, ButtonStyleType } from '../Button/Button';
import Input from '../Input/Input';
import IconProp from 'Common/Types/Icon/IconProp';

export interface ComponentProps {
    onChange?: undefined | ((value: Dictionary<string>) => void);
    initialValue?: Dictionary<string>;
    keyPlaceholder?: string;
    valuePlaceholder?: string;
    addButtonSuffix?: string;

}

interface Item {
    key: string;
    value: string;
}

const DictionaryOfStrings: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [data, setData] = useState<Array<Item>>(
        Object.keys(props.initialValue || {
            '': ''
        }).map((key: string) => {
            return {
                key: key!,
                value: props.initialValue![key] || '',
            };
        }) || [{
            key: '',
            value: '',
        }]
    );

    useEffect(() => {
        const result: Dictionary<string> = {};
        data.forEach((item: Item) => {
            result[item.key] = item.value;
        });
        if (props.onChange) {
            props.onChange(result);
        }
    }, [data]);

    return (
        <div>
            <div>
                {data.map((item: Item, index: number) => {
                    return (
                        <div key={index} className="flex">
                            <div className='mr-1'>
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
                            <div className='ml-1'>
                                <Input
                                    value={item.value}
                                    placeholder={props.valuePlaceholder}
                                    onChange={(value: string) => {
                                        const newData: Array<Item> = [...data];
                                        newData[index]!.value = value;
                                        setData(newData);
                                    }}
                                />
                            </div>
                            <div className='ml-1 mt-1'>
                                <Button
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
                <div className='-ml-3 mt-4'>
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
                                },
                            ]);
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

export default DictionaryOfStrings;
