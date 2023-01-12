import Color, { RGB } from 'Common/Types/Color';
import React, { CSSProperties, FunctionComponent, ReactElement } from 'react';
import { Black } from 'Common/Types/BrandColors';

export enum PillSize {
    Small = '10px',
    Normal = '13px',
    Large = '15px',
    ExtraLarge = '18px',
}

export interface ComponentProps {
    text: string;
    color: Color;
    size?: PillSize | undefined;
    style?: CSSProperties;
}

const Pill: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const rgb: RGB = Color.colorToRgb(props.color || Black);
    return (
        <span
            data-testid="pill"
            className="rounded-full p-1 pl-3 pr-3"
            style={{
                // https://stackoverflow.com/questions/3942878/how-to-decide-font-color-in-white-or-black-depending-on-background-color

                color:
                    rgb.red * 0.299 + rgb.green * 0.587 + rgb.blue * 0.114 > 186
                        ? '#000000'
                        : '#ffffff',
                backgroundColor: props.color
                    ? props.color.toString()
                    : Black.toString(),
                fontSize: props.size ? props.size.toString() : PillSize.Normal,
                ...props.style,
            }}
        >
            {' '}
            {props.text}{' '}
        </span>
    );
};

export default Pill;
