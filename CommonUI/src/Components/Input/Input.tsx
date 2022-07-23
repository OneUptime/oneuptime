import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';

export interface ComponentProps {
    initialValue?: undefined | string; 
    onClick?: undefined | (() => void);
    placeholder?: undefined | string; 
    error?: undefined | string;
    className?: undefined | string; 
    onChange?: undefined | ((value: string) => void); 
}

const Input: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {

    const [value, setValue] = useState<string>('');

    useEffect(() => {
        if (props.initialValue) {
            setValue(props.initialValue);
        }
    }, []);

    return (<input onChange={(e) => {
        setValue(e.target.value);
        if (props.onChange) {
            props.onChange(e.target.value);
        }
    }} value={value} placeholder={props.placeholder} className={props.className} />)
};

export default Input; 