import { Dictionary } from 'lodash';
import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';
import Button from '../Button/Button';
import Input from '../Input/Input';

export interface ComponentProps {
    onChange?: undefined | ((value: Dictionary<string>) => void);
    initialValue?: Dictionary<string>;
}

interface Item {
    key: string;
    value: string;
}

const DictionaryOfStrings: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const [data, setData] = useState<Array<Item>>(Object.keys(props.initialValue!).map((key: string)=> {
        return {
            key: key!,
            value: props.initialValue![key] || '',
        }
    }) || []);

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
                        <div key={index} className='flex'>
                            <Input

                                value={item.key}
                                onChange={(value: string) => {
                                    const newData: Array<Item> = [...data];
                                    newData[index]!.key = value;
                                    setData(newData);

                                }}
                            />
                            <Input

                                value={item.value}
                                onChange={(value: string) => {
                                    const newData: Array<Item> = [...data];
                                    newData[index]!.value = value;
                                    setData(newData);
                                }}
                            />
                            <Button title='Delete' onClick={() => {
                                const newData: Array<Item> = [...data];
                                newData.splice(index, 1);
                                setData(newData);
                            }} />

                        </div>
                    )
                })}
                <div>
                    <Button title='Add' onClick={() => {
                        setData([
                            ...data,
                            {
                                key: '',
                                value: '',
                            }
                        ]);
                    }} />
                </div>
            </div>
        </div>

    );
};

export default DictionaryOfStrings;
