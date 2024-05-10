import Dictionary from 'Common/Types/Dictionary';
import React, { FunctionComponent, ReactElement } from 'react';
import DictionaryForm, { ValueType } from './Dictionary';

export interface ComponentProps {
    onChange?: undefined | ((value: Dictionary<string>) => void);
    initialValue?: Dictionary<string>;
    keyPlaceholder?: string;
    valuePlaceholder?: string;
    addButtonSuffix?: string;
}

const DictionaryOfStrings: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        // only allow text values
        <DictionaryForm
            {...props}
            valueTypes={[ValueType.Text]}
            onChange={(value: Dictionary<string | number | boolean>) => {
                const stringDict: Dictionary<string> =
                    value as Dictionary<string>;

                // convert all values to strings

                for (const key in stringDict) {
                    if (stringDict[key]) {
                        stringDict[key] = stringDict[key]?.toString() || '';
                    }
                }

                if (props.onChange) {
                    props.onChange(stringDict);
                }
            }}
        />
    );
};

export default DictionaryOfStrings;
