import Loader, { LoaderType } from "./Loader";
import { VeryLightGray } from "../../../Types/BrandColors";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  isVisible: boolean;
}

const PageLoader: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.isVisible) {
    return (
      <div className="flex min-h-[60vh] w-full items-center justify-center">
        <Loader loaderType={LoaderType.Bar} color={VeryLightGray} size={200} />
      </div>
    );
  }
  return <></>;
};

export default PageLoader;
