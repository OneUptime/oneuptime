import Loader, { LoaderType } from "../Loader/Loader";
import { LOADER_BOX_CLASS_NAME, LOADER_COLOR } from "../Loader/LoaderLayout";
import React, { ReactElement } from "react";

/*
 * A card's bar while it loads, in the box every loader shares
 * (LoaderLayout): as tall as an empty card, so the card does not change
 * height when its content, or its empty state, arrives.
 */
const ComponentLoader: () => JSX.Element = (): ReactElement => {
  return (
    <div className={LOADER_BOX_CLASS_NAME} data-testid="component-loader">
      <Loader loaderType={LoaderType.Bar} color={LOADER_COLOR} size={200} />
    </div>
  );
};

export default ComponentLoader;
