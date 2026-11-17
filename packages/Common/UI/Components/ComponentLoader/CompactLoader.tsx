import Loader, { LoaderType } from "../Loader/Loader";
import { LOADER_COLOR } from "../Loader/LoaderLayout";
import React, { ReactElement } from "react";

// A loader for a narrow slot (a step, a row): the shared bar, little room.
const CompactLoader: () => JSX.Element = (): ReactElement => {
  return (
    <div className="my-5 w-full flex justify-center">
      <Loader loaderType={LoaderType.Bar} color={LOADER_COLOR} size={200} />
    </div>
  );
};

export default CompactLoader;
