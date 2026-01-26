import { VeryLightGray } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
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
  className?: string;
}

const Loader: FunctionComponent<ComponentProps> = ({
  size = 50,
  color = VeryLightGray,
  loaderType = LoaderType.Bar,
  className = "",
}: ComponentProps) => {
  if (loaderType === LoaderType.Bar) {
    return (
      <div
        role="status"
        aria-label="Loading"
        aria-live="polite"
        className={`flex justify-center mt-1 ${className}`.trim()}
        data-testid="bar-loader"
      >
        <BarLoader height={4} width={size} color={color.toString()} />
        <span className="sr-only">Loading...</span>
      </div>
    );
  }

  if (loaderType === LoaderType.Beats) {
    return (
      <div
        role="status"
        aria-label="Loading"
        aria-live="polite"
        className={`justify-center mt-1 ${className}`.trim()}
        data-testid="beat-loader"
      >
        <BeatLoader size={size} color={color.toString()} />
        <span className="sr-only">Loading...</span>
      </div>
    );
  }

  return <></>;
};

export default Loader;
