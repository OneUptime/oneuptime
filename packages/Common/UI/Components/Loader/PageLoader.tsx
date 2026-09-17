import Loader, { LoaderType } from "./Loader";
import { Gray500 } from "../../../Types/BrandColors";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  isVisible: boolean;
  /*
   * Lets a full-page caller reserve height (e.g. "min-h-[60vh]") without
   * changing the footprint of the many inline, in-card call sites that rely on
   * the default spacing.
   */
  className?: string | undefined;
}

const PageLoader: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.isVisible) {
    return <></>;
  }

  /*
   * The bar used to be VeryLightGray (#c2c2c2) on white — about 1.7:1, which
   * reads as a blank page rather than a loading one. Gray500 is visible without
   * being loud.
   *
   * "w-full" and "w-max" were both set here, so which one applied came down to
   * the order Tailwind happened to emit them in. The loader is centred by the
   * flex row inside <Loader>, so full width is the one that was wanted.
   */
  return (
    <div
      className={
        props.className ||
        "m-auto mt-52 flex w-full items-center justify-center"
      }
    >
      <Loader loaderType={LoaderType.Bar} color={Gray500} size={200} />
    </div>
  );
};

export default PageLoader;
