import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import 'react-toggle/style.css';

export interface RadioButton {
    title: string,
    description?: string | undefined,
    value: string
}

export interface ComponentProps {
    onChange: (value: string) => void;
    initialValue?: string | undefined;
    onFocus?: () => void;
    onBlur?: () => void;
    tabIndex?: number | undefined;
    options: Array<RadioButton>
}

const RadioButtons: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [value, setValue] = useState<string>('');

    useEffect(() => {
        if (props.initialValue) {
            setValue(props.initialValue);
            props.onChange(props.initialValue);
        } else {
            setValue('');
            props.onChange('');
        }
    }, [props.initialValue]);

    const handleChange: Function = (content: string): void => {
        setValue(content);
        props.onChange(content);
    };

    return (
        <div className='form-control radio-group'>
            {props.options && props.options.map((radioButton: RadioButton, i: number) => {
                return (<div key={i} className='flex radio-box' onClick={() => {
                    handleChange(radioButton.value);
                }}>
                    <div className='radio-circle-box'>
                        {value !== radioButton.value ? <div className='radio-empty-circle'> </div> :
                            <div className='radio-empty-circle radio-checked-circle'> </div>}
                    </div>
                    <div className='radio-text-box'>
                        <div className='radio-text-title'>
                            {radioButton.title}
                        </div>
                        <div className='radio-text-box-description'>
                            {radioButton.description}
                        </div>
                    </div>
                </div>)
            })}

        </div>
    );
};

export default RadioButtons;
