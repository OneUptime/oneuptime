import { Grey } from 'Common/Types/BrandColors';
import Color from 'Common/Types/Color';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    placeholder?: undefined | string;
    className?: undefined | string;
    value?: Color | undefined;
    dataTestId?: string;
    onClick?: (() => void) | undefined;
}

const ColorInput: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div
            className={`flex ${props.className}`}
            onClick={() => {
                props.onClick && props.onClick();
            }}
            data-testid={props.dataTestId}
        >
            {props.value && (
                <div
                    style={{
                        backgroundColor: props.value.toString(),
                        height: '20px',
                        borderWidth: '1px',
                        borderColor: Grey.toString(),
                        width: '20px',
                        borderRadius: '300px',
                        boxShadow: 'rgb(149 157 165 / 20%) 0px 8px 24px',
                        marginRight: '7px',
                        borderStyle: 'solid',
                    }}
                ></div>
            )}
            <div>
                {props.value?.toString() ||
                    props.placeholder ||
                    'No Color Selected'}
            </div>
        </div>
    );
};

export default ColorInput;
