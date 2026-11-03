import PageComponentProps from "../PageComponentProps";
import DataCheckTable from "../../Components/DataObservability/DataCheckTable";
import React, { FunctionComponent, ReactElement } from "react";

// Every check on the project's tables, failing first; each is added on its table's own page.
const DataObservabilityChecksPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <DataCheckTable />;
};

export default DataObservabilityChecksPage;
