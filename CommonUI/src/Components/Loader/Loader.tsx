import { VeryLightGray } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import React, { FunctionComponent } from "react";
import BarLoader from "react-spinners/BarLoader";
import BeatLoader from "react-spinners/BeatLoader";

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
  color = VeryLightGray,
  loaderType = LoaderType.Bar,
}: ComponentProps) => {
  if (loaderType === LoaderType.Bar) {
    return (
      <div
        role="bar-loader mt-1"
        className="justify-center"
        data-testid="loader"
      >
        <BarLoader height={4} width={size} color={color.toString()} />
      </div>
    );
  }

  if (loaderType === LoaderType.Beats) {
    return (
      <div
        role="beat-loader mt-1"
        className="justify-center"
        data-testid="loader"
      >
        <BeatLoader size={size} color={color.toString()} />
      </div>
    );
  }

  return <></>;
};

export default Loader;
