import BarLoader from 'react-spinners/BarLoader';
import BeatLoader from 'react-spinners/BeatLoader';
import React, { FunctionComponent } from 'react';
import Color from 'Common/Types/Color';

export enum LoaderType {
    Bar,
    Beats,
}

export interface ComponentProps {
    size?: undefined | number;
    color?: undefined | Color;
    loaderType?: undefined | LoaderType;
}

const Loader: FunctionComponent<ComponentProps> = ({
    size = 50,
    color = new Color('#000000'),
    loaderType = LoaderType.Bar,
}: ComponentProps) => {
    if (loaderType === LoaderType.Bar) {
        return (
            <div role="bar-loader">
                <BarLoader height={4} width={size} color={color.toString()} />
            </div>
        );
    }

    if (loaderType === LoaderType.Beats) {
        return (
            <div role="beat-loader">
                <BeatLoader size={size} color={color.toString()} />
            </div>
        );
    }

    return <></>;
};

export default Loader;
