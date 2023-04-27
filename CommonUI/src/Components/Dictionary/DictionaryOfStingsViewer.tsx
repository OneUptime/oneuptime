import { Dictionary } from 'lodash';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';

export interface ComponentProps {
    value?: Dictionary<string>;
}

interface Item {
    key: string;
    value: string;
}

const DictionaryOfStringsViewer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [data, setData] = useState<Array<Item>>([]);

    useEffect(() => {
        setData(
            Object.keys(
                props.value || {
                    '': '',
                }
            ).map((key: string) => {
                return {
                    key: key!,
                    value: props.value![key] || '',
                };
            }) || [
                {
                    key: '',
                    value: '',
                },
            ]
        );
    }, [props.value]);

    return (
        <div>
            <div>
                {data.map((item: Item, index: number) => {
                    return (
                        <div key={index} className="flex">
                            <div className="mr-1">
                                <div>{item.key}</div>
                            </div>
                            <div className="ml-1">
                                <div>{item.value}</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default DictionaryOfStringsViewer;
