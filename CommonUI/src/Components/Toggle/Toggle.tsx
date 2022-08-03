import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import 'react-toggle/style.css';
import ReactToggle from 'react-toggle';

export interface ComponentProps {
    onChange: (value: boolean) => void;
    initialValue: boolean;
    onFocus?: () => void;
    onBlur?: () => void;
}

const Toggle: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isChecked, setIsChecked] = useState<boolean>(false);

    useEffect(() => {
        if (props.initialValue) {
            setIsChecked(props.initialValue);
        }
    }, [props.initialValue]);

    const handleChange: Function = (content: boolean): void => {
        setIsChecked(content);
        props.onChange(content);
    };

    return (
        <div>
            <ReactToggle
                checked={isChecked}
                onChange={(e: React.ChangeEvent<HTMLElement>) => {
                    if (props.onFocus) {
                        props.onFocus();
                    }
                    if (props.onBlur) {
                        props.onBlur();
                    }
                    handleChange((e.target as any).checked as boolean);
                }}
            />
        </div>
    );
};

export default Toggle;
