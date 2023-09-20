
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import Input from '../Input/Input';
import Button, { ButtonStyleType } from '../Button/Button';
import ObjectID from 'Common/Types/ObjectID';
import IconProp from 'Common/Types/Icon/IconProp';

export interface ComponentProps {
    initialValue?: undefined | ObjectID;
    onChange?: undefined | ((value: ObjectID) => void);
    value?: ObjectID | undefined;
    readOnly?: boolean | undefined;
    disabled?: boolean | undefined;
    dataTestId?: string | undefined;
    tabIndex?: number | undefined;
    onEnterPress?: (() => void) | undefined;
    error?: string | undefined;

}

const IDGenerator: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {


    const [value, setValue] = useState<ObjectID | null>(null);



    useEffect(() => {
        if (props.initialValue) {
            setValue(props.initialValue);
        }

        if (props.value) {
            setValue(props.value);
        }
    }, []);

    useEffect(() => {
        if (props.initialValue) {
            setValue(props.initialValue);
        }
    }, [props.initialValue]);

    useEffect(() => {
        setValue(props.value ? props.value : props.initialValue || null);
    }, [props.value]);

    return (
        <>
            <>
                <div className='flex'>
                    {value && <Input value={value.toString()} />}
                    <div className='mt-2'>
                        <Button icon={IconProp.Refresh} buttonStyle={ButtonStyleType.NORMAL} disabled={props.disabled} title={value ? 'Regenerate' :'Generate'} onClick={() => {
                            const generatedID: ObjectID = ObjectID.generate();
                            setValue(generatedID);
                            props.onChange && props.onChange(generatedID);
                        }} />
                    </div>
                </div>
            </>
            {props.error && (
                <p
                    data-testid="error-message"
                    className="mt-1 text-sm text-red-400"
                >
                    {props.error}
                </p>
            )}
        </>
    );
};

export default IDGenerator;
