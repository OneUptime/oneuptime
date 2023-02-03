import type { RGB } from 'Common/Types/Color';
import Color from 'Common/Types/Color';
import type { CSSProperties, FunctionComponent, ReactElement } from 'react';
import React from 'react';
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
    isMinimal?: boolean | undefined;
}

const Pill: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const rgb: RGB = Color.colorToRgb(props.color || Black);

    if (props.isMinimal) {
        return (
            <span className="relative inline-flex items-center rounded-full border border-gray-300 px-3 py-0.5 text-sm">
                <span className="absolute flex flex-shrink-0 items-center justify-center">
                    <span
                        className="h-1.5 w-1.5 rounded-full bg-rose-500"
                        style={{
                            backgroundColor:
                                props.style?.backgroundColor || props.color
                                    ? props.color.toString()
                                    : Black.toString(),
                        }}
                        aria-hidden="true"
                    ></span>
                </span>
                <span className="ml-3.5 font-medium text-gray-900">
                    {props.text}
                </span>
            </span>
        );
    }
    return (
        <span
            data-testid="pill"
            className="rounded-full p-1 pl-3 pr-3"
            style={{
                // https://stackoverflow.com/questions/3942878/how-to-decide-font-color-in-white-or-black-depending-on-background-color

                color:
                    props.style?.color ||
                    rgb.red * 0.299 + rgb.green * 0.587 + rgb.blue * 0.114 > 186
                        ? '#000000'
                        : '#ffffff',
                backgroundColor:
                    props.style?.backgroundColor || props.color
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
