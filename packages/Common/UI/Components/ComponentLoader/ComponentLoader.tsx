import CompactLoader from "./CompactLoader";
import React, { ReactElement } from "react";

const ComponentLoader: () => JSX.Element = (): ReactElement => {
  return (
    <div className="my-16" data-testid="component-loader">
      <CompactLoader />
    </div>
  );
};

export default ComponentLoader;
